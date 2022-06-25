import { ComponentPropsWithoutRef, FC, useEffect, useMemo, useState } from 'react';
import { CellProps, Column, useTable } from 'react-table';
import { Formik, FormikErrors, FormikTouched } from 'formik';
import * as yup from 'yup';
import './App.scss';

/**
 * Interface contract of subnet calculation form parameters.
 */
interface IFormParams {
    network: string;
    netbits: string;
}

/**
 * Interface contract of a node calculation result.
 */
interface INodeChildResult {
    node: any;
    value: number;
}

/**
 * Interface contract of a calculated subnet.
 */
interface ISubnet {
    subnetAddress: string;
    netmask: string;
    addresses: {
        start: string;
        end?: string;
    };
    usable: {
        start: string;
        end?: string;
    };
    hosts: number;
    actions: {
        split: boolean;
        splits: ISubnetSplit[];
        nodes: any[];
    }
}

/**
 * Interface contract of a subnet calculation result.
 */
interface ISubnetCalculation {
    error?: string;
    joinSpan: number;
    rootSubnet: any[];
    subnets: ISubnet[];
}

export interface ISubnetSplit {
    mask: string;
    rowSpan: number;
    colSpan: number;
    join: boolean;
    node: any | any[];
}

/**
 * Calculation utilities.
 */
const utils = {

    /**
     * Validates and translates a network address from its IP representation to its
     * numeric notation equivalent.
     * 
     * @param {string} value 
     * @returns {number | null}
     */
    _addrToNot: function ( value: string ): number | null {
        const regex = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;
        const result = regex.exec( value );

        if ( result === null )
            return null;

        for ( let i = 0; i <= 4; i++ ) {
            if ( parseInt( result[ i ]) < 0 || parseInt( result[ i ]) > 255 )
                return null;
        }

        return ( parseInt( result[ 1 ]) << 24 ) |
            ( parseInt( result[ 2 ]) << 16 ) |
            ( parseInt( result[ 3 ]) << 8 ) |
            parseInt( result[ 4 ]);
    },

    _createSubnet: function( node: any, address: number, mask: number, labels: any, depth: number ): ISubnet[] {
        if ( node[ 2 ]) {
            let subnets: ISubnet[] = [];

            let newLabels = labels;
            newLabels.push( mask + 1 );
            newLabels.push( node[ 2 ][ 0 ][ 1 ]);
            newLabels.push( node[ 2 ][ 0 ]);
            subnets = subnets.concat( ...utils._createSubnet( node[ 2 ][ 0 ], address, mask + 1, newLabels, depth - 1 ));

            newLabels = [];
            newLabels.push( mask + 1 );
            newLabels.push( node[ 2 ][ 1 ][ 1 ]);
            newLabels.push( node[ 2 ][ 1 ]);
            subnets = subnets.concat( ...utils._createSubnet( node[ 2 ][ 1 ], address + utils._subnetAddrs( mask + 1 ), mask + 1, newLabels, depth - 1 ));

            return subnets;
        } else {
            const subnetAddress = `${utils._notToAddr( address )}/${mask}`;
            const subnetNetmask = utils._notToAddr( utils._subnetNetmask( mask ));
            const addressFirst = address;
            const addressLast = utils._subnetLastAddr( address, mask );
            const usableFirst = address + 1;
            const usableLast = addressLast - 1;
            
            let hostCount = 0,
                addressStart = '',
                addressEnd: string | undefined,
                usableStart = '',
                usableEnd: string | undefined;

            if ( mask === 32 ) {
                addressStart = utils._notToAddr( addressFirst );
                usableStart = addressStart;
                hostCount = 1;
            } else {
                addressStart = utils._notToAddr( addressFirst );
                addressEnd = utils._notToAddr( addressLast );

                if ( mask === 31 ) {
                    usableStart = addressStart;
                    usableEnd = addressEnd;
                    hostCount = 2;
                } else {
                    usableStart = utils._notToAddr( usableFirst );
                    usableEnd = utils._notToAddr( usableLast );
                    hostCount = ( 1 + usableLast - usableFirst );
                }
            }

            const canSplit = ( mask < 32 );
            let splits: ISubnetSplit[] = [],
                colspan = depth - node[ 0 ];

            for ( let i = ( labels.length / 3 ) - 1; i >= 0; i-- ) {
                const mask = labels[ i * 3 ];
                const rowspan = labels[( i * 3 ) + 1 ];
                const joinNode = labels[( i * 3 ) + 2 ];
                const rowSpan = ( rowspan > 1 ? rowspan : 1 );
                const colSpan = ( colspan > 1 ? colspan : 1 );
                const join = ( i !== ( labels.length / 3 ) - 1 );

                splits.push({
                    mask,
                    rowSpan,
                    colSpan,
                    join,
                    node: joinNode
                });

                colspan = 1;
            }

            return [{
                subnetAddress,
                netmask: subnetNetmask,
                addresses: {
                    start: addressStart,
                    end: addressEnd
                },
                usable: {
                    start: usableStart,
                    end: usableEnd
                },
                hosts: hostCount,
                actions: {
                    split: canSplit,
                    splits,
                    nodes: node
                }
            }];
        }
    },

    /**
     * Appends the mask bits to a numeric address notation.
     * 
     * @param {number} ipNot 
     * @param {number} mask 
     * @returns {number}
     */
    _networkAddr: function( ipNot: number, mask: number ): number {
        for ( let i = 31 - mask; i >= 0; i-- )
            ipNot &= ~ 1 << i;

        return ipNot;
    },

    /**
     * Translates a network address from its numeric notation to its IP address
     * equivalent.
     * 
     * @param {number} value 
     * @returns {string}
     */
    _notToAddr: function( ipNot: number ): string {
        return (( ipNot >> 24 ) & 0xff ) + '.' +
            (( ipNot >> 16 ) & 0xff ) +'.'+
            (( ipNot >> 8 ) & 0xff ) +'.'+
            ( ipNot & 0xff );
    },

    _subnetAddrs: function( mask: number ): number {
        return 1 << ( 32 - mask );
    },

    _subnetLastAddr: function( subnet: number, mask: number ): number {
        return subnet + utils._subnetAddrs( mask ) - 1;
    },

    _subnetNetmask: function( mask: number ): number {
        return this._networkAddr( 0xffffffff, mask );
    },

    /**
     * Calculates subnet node child count.
     * 
     * @param node 
     * @returns {INodeChildResult}
     */
    _updateChildCount: function( node: any ): INodeChildResult {
        if ( node[ 2 ] === null ) {
            node[ 1 ] = 0;
            return {
                node,
                value: 1
            };
        }

        node[ 1 ] = utils._updateChildCount( node[ 2 ][ 0 ]).value +
            utils._updateChildCount( node[ 2 ][ 1 ]).value;
        return {
            node,
            value: node[ 1 ]
        };
    },

    /**
     * Calculates subnet node child depth.
     * 
     * @param node 
     * @returns {INodeChildResult}
     */
    _updateChildDepth: function( node: any ): INodeChildResult {
        if ( node[ 2 ] === null ) {
            node[ 0 ] = 0;
            return {
                node,
                value: 1
            };
        }

        node[ 0 ] = utils._updateChildDepth( node[ 2 ][ 0 ]).value +
            utils._updateChildDepth( node[ 2 ][ 1 ]).value;

        return {
            node,
            value: node[ 1 ]
        };
    },

    /**
     * Calculates one or more subnets from a network address and mask.
     * 
     * @param {string} networkStr 
     * @param {string} netbitsStr 
     * @param {any[]} rootSubnet 
     * @returns {ISubnetCalculation}
     */
    calculate: function(
        networkStr: string,
        netbitsStr: string,
        rootSubnet: any[] ): ISubnetCalculation {

        let result: ISubnetCalculation = {
            joinSpan: 0,
            rootSubnet: [],
            subnets: []
        };

        const network = utils._addrToNot( networkStr );
        if ( network === null ) {
            result.error = 'Invalid network address.';
            return result;
        }

        const mask = parseInt( netbitsStr );
        if ( mask < 0 || mask > 32 ) {
            result.error = 'Invalid network mask.';
            return result;
        }

        rootSubnet = utils._updateChildCount( rootSubnet ).node;
        rootSubnet = utils._updateChildDepth( rootSubnet ).node;

        result.subnets = utils._createSubnet(
            rootSubnet,
            network,
            mask,
            [ mask, rootSubnet[ 1 ], rootSubnet ],
            rootSubnet[ 0 ]!
        );
        result.joinSpan = ( rootSubnet[ 0 ]! > 0 ) ? rootSubnet[ 0 ]! : 1;
        result.rootSubnet = rootSubnet;

        return result;
    },

    /**
     * Splits a subnet into two.
     * 
     * @param {string} networkStr 
     * @param {string} netbitsStr 
     * @param {any[]} rootSubnet 
     * @param {any[]} nodes 
     * @returns {ISubnetCalculation}
     */
    split: function(
        networkStr: string,
        netbitsStr: string,
        rootSubnet: any[],
        nodes: any[] ): ISubnetCalculation {
        
        nodes[ 2 ] = new Array<any>();
        nodes[ 2 ][ 0 ] = [ 0, 0, null ];
        nodes[ 2 ][ 1 ] = [ 0, 0, null ];

        return utils.calculate( networkStr, netbitsStr, rootSubnet );
    },

    /**
     * Joins two subnets into one.
     * 
     * @param {string} networkStr 
     * @param {string} netbitsStr 
     * @param {any[]} rootSubnet 
     * @param {any[]} nodes 
     * @returns {ISubnetCalculation}
     */
    join: function(
        networkStr: string,
        netbitsStr: string,
        rootSubnet: any[],
        nodes: any[] ): ISubnetCalculation {

        nodes[ 2 ] = null;
        return utils.calculate( networkStr, netbitsStr, rootSubnet );
    }
}

/**
 * Default root subnet values.
 */
const defaultRootSubnet: any[] = [ 0, 0, null ];

/**
 * Initial subnet calculation form parameters.
 */
const initialFormParams: IFormParams = {
    network: '192.168.0.0',
    netbits: '16'
};

/**
 * Component for rendering a subnet table cell.
 * 
 * @param props 
 * @returns 
 */
const TableCell: FC<ComponentPropsWithoutRef<any>> = ( props ) => (
    <div className="d-flex align-items-center">
        { props.children }
    </div>
);

/**
 * Primary entrypoint.
 * 
 * @returns 
 */
const App: FC = () => {
    const [ formParams, setFormParams ] = useState<IFormParams>({ ...initialFormParams });
    const [ result, setResult ] = useState<ISubnetCalculation>({
        joinSpan: 1,
        rootSubnet: defaultRootSubnet,
        subnets: []
    });

    /**
     * Adds Bootstrap form validation className if Formik's parameters have been
     * modified.
     * 
     * @param {FormikErrors<IFormParams>} err 
     * @param {FormikTouched<IFormParams>} tch 
     * @returns {string}
     */
    const formClasses = ( err: FormikErrors<IFormParams>, tch: FormikTouched<IFormParams> ): string => {
        let classes = [ 'px-0 needs-validation' ];

        if ( err.netbits ||
            err.network ||
            tch.netbits ||
            tch.network )
            classes.push( 'was-validated' );

        return classes.join( ' ' );
    };

    /**
     * Begins a fresh subnet calculation.
     * 
     * @param {string} networkStr 
     * @param {string} netbitsStr 
     * @param {any} rootSubnet 
     */
    const calculate = ( networkStr: string, netbitsStr: string, rootSubnet: any ) => {
        const result = utils.calculate( networkStr, netbitsStr, rootSubnet );
        setResult( result );
    };

    /**
     * Joins two subnets into one.
     * 
     * @param {ISubnetSplit} split 
     */
    const handleJoin = ( split: ISubnetSplit ) => {
        const result = utils.join(
            formParams.network,
            formParams.netbits,
            defaultRootSubnet,
            split.node );

        setResult( result );
    };

    /**
     * Splits a subnet into two.
     * 
     * @param {number} rowIndex 
     */
    const handleSplit = ( rowIndex: number ) => {
        setResult( prev => {
            const subnet = prev.subnets[ rowIndex ];
            const next = utils.split(
                formParams.network,
                formParams.netbits,
                defaultRootSubnet,
                subnet.actions.nodes
            );

            return {
                ...prev,
                ...next
            };
        })
    };

    /**
     * Collection of table columns for displaying calculated subnets.
     */
    const columns = useMemo<Column<ISubnet>[]>( () => [
        {
            Header: 'Subnet Address',
            accessor: 'subnetAddress'
        },
        {
            Header: 'Netmask',
            accessor: 'netmask'
        },
        {
            Header: 'Address Range',
            id: 'addressRange',
            Cell: ({ row }: CellProps<ISubnet> ) => {
                const range = row.original.addresses;
                const text = ( range.end )
                    ? `${range.start} - ${range.end}`
                    : range.start;

                return (
                    <span>{ text }</span>
                );
            }
        },
        {
            Header: 'Usable Range',
            id: 'usableRange',
            Cell: ({ row }: CellProps<ISubnet> ) => {
                const range = row.original.usable;
                const text = ( range.end )
                    ? `${range.start} - ${range.end}`
                    : range.start;

                return (
                    <span>{ text }</span>
                );
            }
        },
        {
            Header: 'Hosts',
            accessor: 'hosts'
        },
        {
            Header: 'Split',
            id: 'split',
            Cell: ({ row }: CellProps<ISubnet> ) => (
                <TableCell>
                    <button
                        type="button"
                        className="btn btn-link btn-sm p-0 border-0"
                        disabled={ !row.original.actions.split }
                        onClick={ () => handleSplit( row.index )}>
                        Split
                    </button>
                </TableCell>
            )
        },
        {
            Header: 'Join',
            id: 'join'
        }
    ], [] );

    /**
     * On initial load, immediately calculate for the default.
     */
    useEffect( () => {
        calculate(
            initialFormParams.network,
            initialFormParams.netbits,
            defaultRootSubnet );
    }, [] );

    const {
        allColumns,
        getTableProps,
        getTableBodyProps,
        headerGroups,
        rows,
        prepareRow
    } = useTable({ columns, data: result.subnets });

    return (
        <div className="container">
            <main>
                <div className="row py-5">
                    <h2 className="px-0">Visual Subnet Calculator</h2>
                </div>

                <div className="row mb-5">
                    <Formik
                        initialValues={ initialFormParams }
                        validationSchema={ yup.object().shape({
                            network: yup.string()
                                .required( 'Required.' )
                                .matches( /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/gm, 'Must be a valid IP address.' ),
                            netbits: yup.string()
                                .required( 'Required.' )
                                .matches( /^[0-9]{2}$/, 'Must be a 2-digit numeric value.' )
                        })}
                        validateOnBlur
                        onSubmit={( values ) => {
                            setFormParams( values );
                            calculate( values.network, values.netbits, defaultRootSubnet );
                        }}>
                            {({
                                values,
                                errors,
                                touched,
                                handleChange,
                                handleBlur,
                                handleSubmit
                            }) => (
                                <form className={ formClasses( errors, touched )} noValidate onSubmit={ handleSubmit }>
                                    <div className="d-flex flex-row align-items-end">
                                        <div className="d-flex flex-column">
                                            <label htmlFor="network" className="form-label form-label-sm">Network Address</label>
                                            <input
                                                autoComplete="no-complete"
                                                type="text"
                                                id="network"
                                                name="network"
                                                className="form-control form-control-sm"
                                                onChange={ handleChange }
                                                onBlur={ handleBlur }
                                                value={ values.network }
                                            />
                                            { errors.network && touched.network && (
                                                <div className="invalid-feedback">
                                                    { errors.network }
                                                </div>
                                            )}
                                        </div>

                                        <div className="d-flex flex-column justify-content-end pb-1 px-2">/</div>

                                        <div className="d-flex flex-column">
                                            <label htmlFor="network" className="form-label form-label-sm">Mask Bits</label>
                                            <input
                                                type="text"
                                                id="netbits"
                                                name="netbits"
                                                className="form-control form-control-sm"
                                                onChange={ handleChange }
                                                onBlur={ handleBlur }
                                                value={ values.netbits }
                                            />
                                            { errors.netbits && touched.netbits && (
                                                <div className="invalid-feedback">
                                                    { errors.netbits }
                                                </div>
                                            )}
                                        </div>

                                        <button type="submit" className="ms-2 btn btn-sm btn-primary">Update</button>
                                    </div>
                                </form>
                            )}
                    </Formik>
                </div>

                <div className="row">
                    <div className="d-flex flex-row px-0">
                        <small className="text-muted me-2">Toggle Visibility:</small>
                        { allColumns.map( column => (
                            <div key={ column.id } className="form-check form-check-inline small">
                                <input className="form-check-input" type="checkbox" id={ column.id } { ...column.getToggleHiddenProps() } />
                                <label className="form-check-label" htmlFor={ column.id }>{ column.Header?.toString() ?? column.id }</label>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="row">
                    <table className="table table-sm table-bordered border-dark" { ...getTableProps() }>
                        <thead>
                            { headerGroups.map( headerGroup => (
                                <tr { ...headerGroup.getHeaderGroupProps() }>
                                    { headerGroup.headers.map( column => {
                                        if ( column.id === 'join' ) {
                                            return (
                                                <th { ...column.getHeaderProps() } className="bg-light" colSpan={ result.joinSpan }>
                                                    { column.render( 'Header' )}
                                                </th>
                                            );
                                        }

                                        return (
                                            <th { ...column.getHeaderProps() } className="bg-light">
                                                { column.render( 'Header' )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody { ...getTableBodyProps() }>
                            { rows.map( row => {
                                prepareRow( row );

                                return (
                                    <tr { ...row.getRowProps() }>
                                        { row.cells.map( cell => {
                                            if ( cell.column.id === 'join' ) {
                                                return row.original.actions.splits.map(( split, key ) => (
                                                    <td
                                                        { ...cell.getCellProps() }
                                                        key={ key }
                                                        className="subnet-join"
                                                        colSpan={ split.colSpan }
                                                        rowSpan={ split.rowSpan }>
                                                        
                                                        <div className="d-flex align-items-center justify-content-end w-100 h-100">
                                                            { !split.join
                                                                ? ( <span>/{ split.mask }</span> )
                                                                : (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-link p-0 border-0"
                                                                        onClick={ () => handleJoin( split )}>
                                                                        <span>/{ split.mask }</span>
                                                                    </button>
                                                                )}
                                                        </div>
                                                    </td>
                                                ))
                                            }

                                            return (
                                                <td { ...cell.getCellProps() }>
                                                    { cell.render( 'Cell' )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
};

export default App;
